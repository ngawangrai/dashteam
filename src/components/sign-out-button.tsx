import { Button } from "./button";

export function SignOutButton() {
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant="plain">
        Sign out
      </Button>
    </form>
  );
}
