using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Models;
using backend.Data;
using backend.Services;

namespace backend.Controllers;

[ApiController]
[Route("api/customer")]
public class CustomerController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly RiskEngineService    _riskService;
    private readonly MLService            _mlService;

    public CustomerController(
        ApplicationDbContext context,
        RiskEngineService    riskService,
        MLService            mlService)
    {
        _context     = context;
        _riskService = riskService;
        _mlService   = mlService;
    }

    [HttpGet]
    public async Task<IActionResult> GetCustomers()
    {
        var customers = await _context.Customers.ToListAsync();
        return Ok(customers);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetCustomer(long id)
    {
        var customer = await _context.Customers.FindAsync(id);
        if (customer == null) return NotFound();
        return Ok(customer);
    }

    [HttpPost("calculate-risk/{id}")]
    public async Task<IActionResult> CalculateRisk(long id)
    {
        var customer = await _context.Customers.FindAsync(id);
        if (customer == null) return NotFound();

        double baseRisk  = _riskService.CalculateBaseRisk(customer);
        double mlRisk    = await _mlService.GetMLScore(customer);
        double finalRisk = baseRisk + mlRisk;
        string category  = _riskService.GetRiskCategory(finalRisk);

        return Ok(new
        {
            customer.CustomerId,
            customer.Name,
            BaseRisk  = baseRisk,
            MLRisk    = mlRisk,
            FinalRisk = finalRisk,
            Category  = category
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Separate controller mounted at /risk/{id}
// This is the endpoint the Gateway calls. Returns field names that match
// what the unified frontend expects: riskScore, riskLevel.
// ─────────────────────────────────────────────────────────────────────────
[ApiController]
[Route("risk")]
public class RiskController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly RiskEngineService    _riskService;
    private readonly MLService            _mlService;

    public RiskController(
        ApplicationDbContext context,
        RiskEngineService    riskService,
        MLService            mlService)
    {
        _context     = context;
        _riskService = riskService;
        _mlService   = mlService;
    }

    /// <summary>
    /// Called by the AML Gateway. Returns riskScore + riskLevel for the
    /// unified customer profile view.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetRisk(long id)
    {
        var customer = await _context.Customers.FindAsync(id);
        if (customer == null)
            return NotFound(new { error = true, message = $"Customer {id} not found" });

        double baseRisk  = _riskService.CalculateBaseRisk(customer);
        double mlRisk    = await _mlService.GetMLScore(customer);
        double riskScore = baseRisk + mlRisk;
        string riskLevel = _riskService.GetRiskCategory(riskScore);

        return Ok(new
        {
            customerId       = customer.CustomerId,
            name             = customer.Name,
            riskScore        = Math.Round(riskScore, 1),
            riskLevel,
            baseRisk         = Math.Round(baseRisk,  1),
            mlRisk           = Math.Round(mlRisk,    1),
            isPEP            = customer.IsPEP,
            hasAdverseMedia  = customer.HasAdverseMedia,
            highRiskCountry  = customer.HighRiskCountry,
            highRiskBusiness = customer.HighRiskBusiness
        });
    }
}
