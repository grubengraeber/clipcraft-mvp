import { describe, expect, it } from "vitest";

import { apiErrorResponse } from "@/lib/api-responses";

describe("apiErrorResponse", () => {
  it("maps auth errors to 401 responses", async () => {
    const response = apiErrorResponse(new Error("AUTH_REQUIRED"), "fallback");

    await expect(response.json()).resolves.toEqual({
      error: "Bitte melde dich per Login-Code an.",
    });
    expect(response.status).toBe(401);
  });

  it("maps regular errors to the provided status", async () => {
    const response = apiErrorResponse(new Error("Boom"), "fallback", 418);

    await expect(response.json()).resolves.toEqual({ error: "Boom" });
    expect(response.status).toBe(418);
  });
});
