using System.Text;
using System.Text.Json;
using backend.Models;

namespace backend.Services;

public class MLService
{
    private readonly HttpClient _httpClient;
    private readonly string _mlUrl;

    public MLService(HttpClient httpClient, IConfiguration config)
    {
        _httpClient = httpClient;
        // Priority: appsettings.json "ML_SERVICE_URL" key
        //           → environment variable ML_SERVICE_URL
        //           → localhost fallback for local dev
        _mlUrl = config["ML_SERVICE_URL"]
              ?? Environment.GetEnvironmentVariable("ML_SERVICE_URL")
              ?? "http://localhost:8000";
    }

    private static bool IsTrue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var v = value.Trim().ToLowerInvariant();
        return v == "true" || v == "1" || v == "yes";
    }

    public async Task<double> GetMLScore(Customer customer)
    {
        try
        {
            var payload = new
            {
                IsPEP            = IsTrue(customer.IsPEP),
                HasAdverseMedia  = IsTrue(customer.HasAdverseMedia),
                HighRiskCountry  = IsTrue(customer.HighRiskCountry),
                HighRiskBusiness = IsTrue(customer.HighRiskBusiness)
            };

            var json     = JsonSerializer.Serialize(payload);
            var content  = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_mlUrl}/predict", content);
            var body     = await response.Content.ReadAsStringAsync();

            using JsonDocument doc = JsonDocument.Parse(body);
            return doc.RootElement.GetProperty("score").GetDouble();
        }
        catch
        {
            // ML service unavailable → fall back to 0 (base risk still applies)
            return 0;
        }
    }
}
