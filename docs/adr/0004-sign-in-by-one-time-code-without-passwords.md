# Users sign in with a one-time code from an Admin, without passwords

Four members of staff use the app on their own phones, and attributing every action to the right User is the point of the app. An Admin adds a User and reads out a one-time code; entering it signs that phone in, and the phone stays signed in for as long as it keeps being used. The cost is that a new or wiped phone needs an Admin, and if every Admin is signed out at once the developer has to issue a code from the command line.

## Considered Options

- **Name and password**: forgotten, chosen weakly, and easily lent to a colleague, which undermines attribution. It also needs set and reset screens.
- **Google sign-in**: a third-party dependency, and not every Worker is certain to have an account.
- **Passkeys**: the strongest option and the natural upgrade, but a Worker's phone without a screen lock cannot hold one.
