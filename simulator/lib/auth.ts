import crypto from "crypto";
export function checkPassword(req: Request) {
  const received = crypto
    .createHash("sha256")
    .update(req.headers.get("x-sim-password") || "")
    .digest();
  const expected = crypto
    .createHash("sha256")
    .update(process.env.SIM_PASSWORD || "")
    .digest();
  return crypto.timingSafeEqual(received, expected);
}
