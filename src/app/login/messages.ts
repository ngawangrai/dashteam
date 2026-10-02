// Supabase Auth error codes mapped to plain words. Never show a code to the person.
export function sendCodeErrorMessage(code: string | undefined): string {
  switch (code) {
    case "otp_disabled":
    case "signup_disabled":
    case "user_not_found":
      return "This email isn’t set up for DashTeam yet. Ask your admin to add you.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many codes in a short time. Wait a minute, then try again.";
    default:
      return "We couldn’t send a code just now. Try again in a minute.";
  }
}

import { formatLongDate } from "@/lib/format";

export const NOT_SET_UP_MESSAGE = "Your account isn’t fully set up yet. Ask your admin to check it.";

export function accessEndedMessage(endDate: string): string {
  return `Your DashTeam access ended on ${formatLongDate(endDate)}. For payslips or letters, ask your admin.`;
}

export function verifyCodeErrorMessage(code: string | undefined): string {
  switch (code) {
    // Supabase returns otp_expired for a wrong code as well as an old one.
    case "otp_expired":
      return "That code didn’t work. Check the digits, or send a new code.";
    case "over_request_rate_limit":
      return "Too many tries. Wait a minute, then try again.";
    default:
      return "We couldn’t sign you in just now. Try again in a minute.";
  }
}
