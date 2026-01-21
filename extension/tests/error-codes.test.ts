/**
 * Error Codes Tests (Phase 4)
 *
 * Tests for centralized error model.
 */

import {
  ErrorCodes,
  getErrorByCode,
  createErrorMessage,
} from "../ui/error-codes";

describe("Error Codes", () => {
  describe("ErrorCodes object", () => {
    it("defines all required error types", () => {
      expect(ErrorCodes.NO_PERMISSION).toBeDefined();
      expect(ErrorCodes.NOT_FOUND).toBeDefined();
      expect(ErrorCodes.NO_RUNS).toBeDefined();
      expect(ErrorCodes.NO_ARTIFACTS).toBeDefined();
      expect(ErrorCodes.VERSION_MISMATCH).toBeDefined();
      expect(ErrorCodes.TRANSIENT_ERROR).toBeDefined();
    });

    it("each error has required fields", () => {
      Object.values(ErrorCodes).forEach((error) => {
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe("string");
        expect(error.message).toBeDefined();
        expect(typeof error.message).toBe("string");
        expect(error.action).toBeDefined();
        expect(typeof error.action).toBe("string");
      });
    });

    it("defines predictions-specific errors", () => {
      expect(ErrorCodes.PRED_DISABLED).toBeDefined();
      expect(ErrorCodes.PRED_SCHEMA_INVALID).toBeDefined();
      expect(ErrorCodes.PRED_LOAD_ERROR).toBeDefined();
      expect(ErrorCodes.PRED_HTTP_ERROR).toBeDefined();
    });

    it("defines AI insights-specific errors", () => {
      expect(ErrorCodes.AI_DISABLED).toBeDefined();
      expect(ErrorCodes.AI_SCHEMA_INVALID).toBeDefined();
      expect(ErrorCodes.AI_LOAD_ERROR).toBeDefined();
      expect(ErrorCodes.AI_HTTP_ERROR).toBeDefined();
    });
  });

  describe("getErrorByCode", () => {
    it("finds error by code string", () => {
      const error = getErrorByCode("AUTH_001");
      expect(error).toBeDefined();
      expect(error?.code).toBe("AUTH_001");
    });

    it("returns null for unknown code", () => {
      const error = getErrorByCode("NONEXISTENT_CODE");
      expect(error).toBeNull();
    });

    it("finds predictions error codes", () => {
      const error = getErrorByCode("PRED_001");
      expect(error).toBeDefined();
      expect(error?.message).toContain("validation");
    });
  });

  describe("createErrorMessage", () => {
    it("creates message from error key", () => {
      const result = createErrorMessage("NO_PERMISSION");

      expect(result.code).toBe("AUTH_001");
      expect(result.message).toBeDefined();
      expect(result.action).toBeDefined();
    });

    it("includes optional details in message", () => {
      const result = createErrorMessage("NOT_FOUND", "Pipeline: my-pipeline");

      expect(result.message).toContain("Pipeline: my-pipeline");
    });

    it("falls back to UNKNOWN for invalid key", () => {
      const result = createErrorMessage("INVALID_KEY" as any);

      expect(result.code).toBe("UNKNOWN");
    });
  });
});
