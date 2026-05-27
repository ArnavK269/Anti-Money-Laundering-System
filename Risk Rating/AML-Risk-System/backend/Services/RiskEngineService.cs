using backend.Models;

namespace backend.Services;

public class RiskEngineService
{
    // Normalise any truthy value the DB might store:
    // "True", "true", "TRUE", "1", "yes", "YES" → true
    // Everything else (null, "", "False", "false", "0", "no") → false
    private static bool IsTrue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var v = value.Trim().ToLowerInvariant();
        return v == "true" || v == "1" || v == "yes";
    }

    public double CalculateBaseRisk(Customer customer)
    {
        double score = 0;

        if (IsTrue(customer.IsPEP))            score += 30;
        if (IsTrue(customer.HasAdverseMedia))  score += 25;
        if (IsTrue(customer.HighRiskCountry))  score += 20;
        if (IsTrue(customer.HighRiskBusiness)) score += 15;

        return score;
    }

    public string GetRiskCategory(double score)
    {
        if (score >= 80) return "Critical";
        if (score >= 60) return "High";
        if (score >= 30) return "Medium";
        return "Low";
    }
}
