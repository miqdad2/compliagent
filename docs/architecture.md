# CompliAgent Architecture

CompliAgent is organized around source-preserving technical review workflows:

1. Authenticated users belong to an organization and receive a server-checked role.
2. Projects define the client, discipline, review type, scope, and status.
3. Uploaded documents are stored in private Supabase Storage paths and registered in `documents`.
4. Processing jobs extract page text, chunks, source metadata, and future embeddings.
5. Controlled AI agents operate on structured inputs and return Zod-validated JSON.
6. Compliance findings preserve requirement and evidence citations for human review.
7. Exports and chat responses are generated from reviewed findings and retrieved document sources.

The current implementation initializes this architecture with placeholder extraction and AI interfaces. It intentionally avoids any domain-specific hardcoding.
