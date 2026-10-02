"use client";

import { CircleAlert } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { sendSignInCode, verifySignInCode } from "./actions";
import type { SendCodeState, VerifyCodeState } from "./schema";

const RESEND_AFTER_SECONDS = 30;
const CODE_LENGTH = 6;

const fieldClass =
  "min-h-11 w-full rounded-control bg-surface px-3 text-body text-label placeholder:text-label-secondary aria-invalid:outline-2 aria-invalid:outline-danger";

export function LoginFlow({ notice = null }: { notice?: string | null }) {
  const [sendState, sendAction, isSending] = useActionState<SendCodeState, FormData>(sendSignInCode, { status: "idle" });
  const [resendState, resendAction, isResending] = useActionState<SendCodeState, FormData>(sendSignInCode, { status: "idle" });
  const [verifyState, verifyAction, isVerifying] = useActionState<VerifyCodeState, FormData>(verifySignInCode, { status: "idle" });
  const [editingEmail, setEditingEmail] = useState(false);
  const [code, setCode] = useState("");
  const codeForm = useRef<HTMLFormElement>(null);

  // Editing the email resets once a new code goes out, so the code step follows the latest send.
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  if (sendState.status === "sent" && sendState.sentAt !== lastSentAt) {
    setLastSentAt(sendState.sentAt);
    setEditingEmail(false);
    setCode("");
  }

  const onCodeStep = sendState.status === "sent" && !editingEmail;
  const email = sendState.status === "idle" ? "" : sendState.email;
  const latestSentAt = Math.max(
    sendState.status === "sent" ? sendState.sentAt : 0,
    resendState.status === "sent" ? resendState.sentAt : 0,
  );

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    // Submit as soon as the last digit lands, including when iOS fills the code from Mail.
    if (digits.length === CODE_LENGTH && !isVerifying) {
      queueMicrotask(() => codeForm.current?.requestSubmit());
    }
  }

  if (!onCodeStep) {
    // Shown once after being signed out because access ended; replaced by anything newer.
    const error = sendState.status === "error" ? sendState.message : notice;
    return (
      // Animates only when coming back from the code step, never on first load.
      <div key="email" className={`flex flex-col gap-6 ${editingEmail ? "step-enter [--step-from:-16px]" : ""}`}>
        <div className="flex flex-col gap-2">
          <h1 className="text-large-title">Sign in</h1>
          <p className="text-body text-pretty text-label-secondary">Use your work email. We’ll send you a 6‑digit code.</p>
        </div>
        <form action={sendAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-secondary font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              defaultValue={email}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "email-error" : undefined}
              className={fieldClass}
            />
            {error ? <FieldError id="email-error" message={error} /> : null}
          </div>
          <Button type="submit" fullWidth aria-busy={isSending || undefined} disabled={isSending}>
            {isSending ? "Sending code…" : "Send code"}
          </Button>
        </form>
      </div>
    );
  }

  const error = verifyState.status === "error" ? verifyState.message : resendState.status === "error" ? resendState.message : null;
  return (
    <div key={`code-${lastSentAt}`} className="step-enter flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-large-title">Check your email</h1>
        <p className="text-body text-pretty text-label-secondary">
          Enter the 6‑digit code we sent to <span className="break-all text-label">{email}</span>.
        </p>
      </div>
      <form ref={codeForm} action={verifyAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="email" value={email} />
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-secondary font-medium">
            Code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            autoFocus
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "code-error" : undefined}
            className={`${fieldClass} tabular text-title tracking-[0.3em]`}
          />
          {error ? <FieldError id="code-error" message={error} /> : null}
        </div>
        <Button type="submit" fullWidth aria-busy={isVerifying || undefined} disabled={isVerifying || code.length !== CODE_LENGTH}>
          {isVerifying ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="flex flex-col items-center gap-1">
        <form action={resendAction}>
          <input type="hidden" name="email" value={email} />
          <ResendButton sentAt={latestSentAt} pending={isResending} />
        </form>
        <Button variant="plain" onClick={() => setEditingEmail(true)}>
          Use a different email
        </Button>
      </div>
    </div>
  );
}

function ResendButton({ sentAt, pending }: { sentAt: number; pending: boolean }) {
  const secondsLeft = useSecondsUntil(sentAt + RESEND_AFTER_SECONDS * 1000);
  if (pending) {
    return (
      <Button type="submit" variant="plain" disabled aria-busy>
        Sending a new code…
      </Button>
    );
  }
  return (
    <Button type="submit" variant="plain" disabled={secondsLeft > 0}>
      {secondsLeft > 0 ? <span className="tabular">Send a new code in {secondsLeft}s</span> : "Send a new code"}
    </Button>
  );
}

function useSecondsUntil(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-secondary text-danger">
      <Icon icon={CircleAlert} size={16} className="mt-0.5 shrink-0" />
      <span className="text-pretty">{message}</span>
    </p>
  );
}
