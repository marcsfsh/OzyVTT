# code-reviewer — memory

Curated index of durable code-quality learnings for this repo. Keep this file short; put detail in
sibling topic files and link them here. Update after substantive reviews.

## Recurring bug classes

_(none recorded yet)_

## Fragile / high-churn modules

_(none recorded yet)_

## Conventions worth enforcing

- Wire contract lives once in `packages/domain`; commands validate + authorize + preserve
  idempotency/revision; server authoritative, client math preview-only.

## Notes

_(add per-review findings)_
