# DSH Memory development constraints

- Ship an ordinary DSH plugin. Do not register an independent desktop workbench or require `dsh-desktop-workbenches`.
- Reuse existing DSH workspaces and conversations. Never require recreating workspaces or reassigning conversation ownership to use Memory.
- Keep the Memory settings page and the existing session selection, permission, extraction, and retrieval behavior.
- The server's `/workbench` management webpage is separate from a DSH desktop workbench and remains supported.
- Publish client code only. Never include real credentials, local configuration, conversation transcripts, server source, or business databases.
- Preserve the package name `dsh-memory-bridge-profile` so existing connection and selection settings remain usable.
