# Optional update trust configuration

The public developer edition does not include a deployment trust anchor or any private signing key.

If you are developing the signed-update flow locally, provide your own Ed25519 public verification key at `update-public-key.pem` and keep the matching private key outside the repository. Do not copy a production key into this checkout.
