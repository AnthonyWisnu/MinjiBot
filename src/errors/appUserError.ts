export class AppUserError extends Error {
  readonly isUserSafe = true;

  constructor(message: string) {
    super(message);
    this.name = "AppUserError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
