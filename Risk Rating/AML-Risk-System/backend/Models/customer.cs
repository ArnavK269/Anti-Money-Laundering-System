using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models;

[Table("risk_cust")]
public class Customer
{
    [Key]
    [Column("customer_id")]
    public long CustomerId { get; set; }

    [Column("name")]
    public string? Name { get; set; }

    [Column("IsPEP")]
    public string? IsPEP { get; set; }

    [Column("HasAdverseMedia")]
    public string? HasAdverseMedia { get; set; }

    [Column("HighRiskCountry")]
    public string? HighRiskCountry { get; set; }

    [Column("HighRiskBusiness")]
    public string? HighRiskBusiness { get; set; }

    [NotMapped]
    public double BaseRiskScore { get; set; }

    [NotMapped]
    public double MLAnomalyScore { get; set; }

    [NotMapped]
    public double FinalRiskScore { get; set; }

    [NotMapped]
    public string? RiskCategory { get; set; }
}