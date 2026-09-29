# Contributing

Thanks for helping improve n8n Workflow Visualizer.

## Private-data rule

Never commit real workflow exports, credentials, environment files, local filesystem paths, API keys, webhook URLs, or screenshots containing private workflow data. Tests, examples, and documentation images must use synthetic content.

## Local setup

Node.js 24 LTS is recommended (minimum 22.12).

```bash
npm ci
npm run typecheck
npm run test:run
npm run build
npx playwright install chromium
npm run e2e
```

Keep n8n compatibility parsing isolated from rendering. Decode imports permissively from `unknown`, preserve unfamiliar node and connection data, and add synthetic coverage for every compatibility change. Do not copy n8n frontend code, styles, or components.

Before opening a pull request, confirm that the production build makes no application network calls after workflow import and that generated screenshots contain only the committed synthetic examples.
