# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Refoss firmware and the Refoss cloud (report to Refoss).

The integration keeps one secret: the device password of its configuration
(only when you protected your devices in the Refoss app), stored by Gladys
and never logged. Its `/data` volume keeps the MAC address, IP address, model
and uuid of each device seen, the energy indexes and the "on for" timers.

The current models (RPC) accept commands from anyone on the local network
unless you set a password in the Refoss app; the first models (R10, EM06,
EM16) have no authentication at all. Keep them on a trusted network, never
exposed to the Internet.
