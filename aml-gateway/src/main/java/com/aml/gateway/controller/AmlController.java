package com.aml.gateway.controller;

import com.aml.gateway.service.AmlGatewayService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class AmlController {

    private final AmlGatewayService service;

    public AmlController(AmlGatewayService service) {
        this.service = service;
    }

    @GetMapping("/")
    public Map<String, Object> home() {
        return Map.of(
            "status",    "RUNNING",
            "service",   "AML Gateway",
            "endpoints", new String[]{"/aml/{customerId}", "/health"}
        );
    }

    /** Unified AML profile — aggregates Risk + Screening + Transactions */
    @GetMapping("/aml/{customerId}")
    public Map<String, Object> getAmlProfile(@PathVariable long customerId) {
        return service.getAmlProfile(customerId);
    }

    /** Downstream service health — used by React UI status bar */
    @GetMapping("/health")
    public Map<String, Object> health() {
        return service.healthCheck();
    }
}
