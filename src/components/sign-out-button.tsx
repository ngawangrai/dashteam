import { Button } from "./button";

export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant="plain" className={className}>
        Sign out
      </Button>
    </form>
  );
}
