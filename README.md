# Rukh

Modular AI framework with RAG system supporting multiple LLMs and personalized contexts.

Live at: **[rukh.w3hc.org](http://rukh.w3hc.org)**

## Install

```bash
pnpm i
```

## Test

```bash
# format, lint, build, test, and test:e2e
pnpm dance
```

Or separately: 

```bash
# unit tests
pnpm test

# e2e tests
pnpm test:e2e

# test coverage
pnpm test:cov
```

## Run

```bash
pnpm start
```

The Swagger UI should be available at http://localhost:3000/api

## Example

Simple request: 

```bash
curl 'https://rukh.w3hc.org/ask' \
  -H 'Content-Type: multipart/form-data' \
  -F 'message=What'\''s Rukh?' \
  -F 'context=rukh'
```

Response body:

```json
{
  "output": "Based on the context provided, **Rukh** (also spelled roc, ruḵḵ, or rokh) is an enormous legendary bird of prey from Middle Eastern mythology and folklore.\n\n## Key characteristics:\n\n**Physical Description:**\n- Gigantic eagle-like bird of enormous size\n- So large it could carry off elephants in its talons\n- Described as having quills \"twelve paces long\"\n- Casts shadows as big as clouds when flying\n\n**Cultural Origins:**\n- Appears in Arabic and Persian mythology\n- Featured prominently in \"One Thousand and One Nights\" (Arabian Nights)\n- Mentioned in tales of Sinbad the Sailor\n- Has roots possibly tracing back to the Indian mythological bird Garuda\n\n**Historical Accounts:**\n- Marco Polo described it in the 13th century as living near Madagascar\n- Various travelers and explorers reported sightings or evidence\n- Often associated with tropical islands in the Indian Ocean\n\n**Possible Real-World Connections:**\n- May have been inspired by the extinct Aepyornis (elephant bird) of Madagascar\n- Could be based on exaggerated accounts of large eagles\n- Some \"roc feathers\" were likely palm fronds\n\n**Religious/Literary Significance:**\n- Appears in Ethiopian religious texts (Kebra Negast)\n- Featured in various medieval European accounts\n- Continues to appear in modern fantasy literature and games\n\nThe rukh represents one of the most enduring giant bird myths in world folklore, blending elements of natural observation with fantastical storytelling.",
  "model": "claude-sonnet-5",
  "sessionId": "15a7e248-17f2-4b9e-a42b-000f97a075e7",
  "usage": {
    "input_tokens": 1930,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 0
    },
    "output_tokens": 352,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "cost": {
    "input_cost": 0.005796,
    "output_cost": 0.00528,
    "total_cost": 0.011076
  },
  "rag": {
    "selectedFiles": ["rukh-definition.md"],
    "selectedUrls": [],
    "totalFilesAvailable": 1,
    "totalUrlsAvailable": 0,
    "selectionMethod": "rag-two-step",
    "selectionCost": {
      "input_cost": 0.000006,
      "output_cost": 0,
      "total_cost": 0.000006
    }
  }
}
```

## License

[LGPL-3.0](LICENSE)

## Contact

https://julienberanger.com/contact