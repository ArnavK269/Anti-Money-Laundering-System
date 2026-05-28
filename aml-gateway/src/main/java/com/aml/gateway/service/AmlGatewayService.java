package com.aml.gateway.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AmlGatewayService {

    private final RestTemplate restTemplate;

    @Value("${aml.services.risk-url:http://localhost:8081}")
    private String riskUrl;

    @Value("${aml.services.screening-url:http://localhost:8082}")
    private String screeningUrl;

    @Value("${aml.services.transactions-url:http://localhost:8083}")
    private String transactionsUrl;

    public AmlGatewayService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * Unified AML profile — aggregates all 3 services for a single customer.
     * React frontend reads: profile.risk, profile.screening, profile.transactions
     */
    public Map<String, Object> getAmlProfile(long customerId) {

        Map<String, Object> response = new LinkedHashMap<>();

        // Risk Rating   — GET /risk/{id}         → .NET backend :8081
        response.put("risk", get(riskUrl + "/risk/" + customerId));

        // Screening     — GET /screen/by-customer/{id} → Python Flask :8082
        response.put("screening", get(screeningUrl + "/screen/by-customer/" + customerId));

        // Transactions  — GET /transactions/{id}  → Java Spring Boot :8083
        response.put("transactions", get(transactionsUrl + "/transactions/" + customerId));

        return response;
    }

    /**
     * Health check — pings each downstream service and reports status.
     */
    public Map<String, Object> healthCheck() {

        Map<String, Object> status = new LinkedHashMap<>();
        status.put("gateway",      "UP");
        status.put("riskService",       ping(riskUrl      + "/api/customer"));
        status.put("screeningService",  ping(screeningUrl + "/health"));
        status.put("transactionService",ping(transactionsUrl + "/"));
        return status;
    }

    // ── private helpers ──────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Object get(String url) {
        try {
            ResponseEntity<Map> entity = restTemplate.getForEntity(url, Map.class);
            return entity.getBody();
        } catch (RestClientException ex) {
            return Map.of("error", true, "message", ex.getMessage());
        }
    }

    private String ping(String url) {
        try {
            restTemplate.getForEntity(url, String.class);
            return "UP";
        } catch (Exception e) {
            return "DOWN";
        }
    }
}
