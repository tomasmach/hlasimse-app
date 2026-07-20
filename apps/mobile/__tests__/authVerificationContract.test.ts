import { confirmEmailVerification, register, resendEmailVerification } from "@/lib/auth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  jest.restoreAllMocks();
});

it("registers without attempting a JWT login before e-mail verification", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
    json(
      {
        detail: "Pokud lze adresu použít, poslali jsme na ni odkaz k ověření.",
        verification_required: true,
      },
      202,
    ),
  );

  await expect(
    register({
      email: " NEW@Example.cz ",
      password: "A-strong-unique-password-123",
      firstName: " Alena ",
    }),
  ).resolves.toMatchObject({ verification_required: true });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/auth/register/");
  expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('"email":"new@example.cz"');
});

it("uses unauthenticated resend and confirmation endpoints", async () => {
  const fetchMock = jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      json({ detail: "Pokud lze adresu použít, poslali jsme odkaz.", verification_required: true }, 202),
    )
    .mockResolvedValueOnce(json({ status: "verified" }));

  await resendEmailVerification(" Owner@Example.cz ");
  await expect(confirmEmailVerification("signed-token")).resolves.toEqual({ status: "verified" });

  expect(String(fetchMock.mock.calls[0][0])).toContain("/email-verification/resend/");
  expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('"email":"owner@example.cz"');
  expect(String(fetchMock.mock.calls[1][0])).toContain("/email-verification/confirm/");
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("Authorization")).toBe(false);
});
