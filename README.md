# PC Builder — Backend

API REST per un configuratore di PC: catalogo componenti, build personalizzate con controllo di compatibilità, autenticazione utenti e statistiche. Costruita con [Hono](https://hono.dev) su Node.js.

## Stack

- **Hono** — web framework
- **Drizzle ORM** + **PostgreSQL** ([Neon](https://neon.tech)) — accesso al database
- **Zod** + `@hono/zod-validator` — validazione input
- **JWT** (`jsonwebtoken`) + **bcrypt** — autenticazione
- **Mailtrap** — invio email (verifica account, recupero password)
- **TypeScript**

## Setup

```bash
npm install
cp .env.example .env   # poi compila i valori, vedi sotto
npm run dev
```

Il server parte su `http://localhost:3000`.

## Variabili d'ambiente

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | Connection string Postgres (Neon). In locale va bene quella diretta; in produzione/serverless usa quella **pooled** (host con `-pooler`). |
| `JWT_SECRET` | Stringa segreta per firmare i JWT. Generabile con `openssl rand -hex 32`. |
| `MAILTRAP_SANDBOX_TOKEN` | API token del sandbox Mailtrap (Email Testing → Inbox → API token). |

## Script

| Comando | Descrizione |
|---|---|
| `npm run dev` | Avvia il server in locale con reload automatico (`tsx watch`) |
| `npm run build` | Compila TypeScript in `dist/` |
| `npm start` | Avvia la build compilata (`node dist/index.js`) |

## Deploy

Il progetto è pronto per il deploy **zero-config su Vercel**: [src/app.ts](src/app.ts) esporta l'istanza Hono come default export, che Vercel riconosce automaticamente come Vercel Function. [src/index.ts](src/index.ts) (con `serve()`) è usato solo per l'esecuzione locale/tradizionale.

Su Vercel vanno impostate le stesse variabili d'ambiente elencate sopra in **Project Settings → Environment Variables**.

## Struttura

```
src/
  app.ts              # istanza Hono + route (entry point per Vercel)
  index.ts            # avvio server locale (@hono/node-server)
  db/                  # connessione, schema e relazioni Drizzle
  lib/                 # utility (email, compatibilità componenti, validazioni, ecc.)
  middleware/           # autenticazione JWT e controllo ruoli
  routes/               # endpoint API, vedi sotto
scripts/                # script di seed del database (uno per categoria di componente, con relativo CSV)
```

## Endpoint API

Tutte le route sono montate sotto `/api`.

### Auth — `/api/auth`
| Metodo | Path | Auth | Descrizione |
|---|---|---|---|
| POST | `/login` | — | Login, ritorna JWT |
| GET | `/me` | utente | Dati dell'utente autenticato |
| POST | `/register` | — | Registrazione, invia codice di verifica via email |
| POST | `/email-verify` | — | Verifica email tramite codice |
| POST | `/resend-email-verify` | — | Reinvia codice di verifica |
| POST | `/send-password-recovery` | — | Invia link di recupero password |
| POST | `/password-recovery` | — | Imposta nuova password tramite token |

### Utenti — `/api/users` (solo admin)
| Metodo | Path | Descrizione |
|---|---|---|
| GET | `/` | Lista utenti (paginata, `?page&perPage&with=`) |
| GET | `/:email` | Dettaglio utente |
| POST | `/` | Crea utente |
| PATCH | `/:id` | Aggiorna utente |
| DELETE | `/:id` | Elimina utente |

### Componenti — `/api/components`
Tipi disponibili: `cpus`, `motherboards`, `gpus`, `memory`, `cases`, `psus`, `coolers`, `storage`.

| Metodo | Path | Auth | Descrizione |
|---|---|---|---|
| GET | `/:type` | — | Lista componenti di un tipo, con filtri via query string (es. `?brand=amd&price_gte=100`) |
| GET | `/:type/compatible` | — | Componenti compatibili con una build parziale (`?cpuId=&motherboardId=...`) |
| GET | `/:type/:id` | — | Dettaglio componente |
| POST | `/:type` | admin | Crea componente |
| PUT | `/:type/:id` | admin | Aggiorna componente |
| DELETE | `/:type/:id` | admin | Elimina componente |

### Build — `/api/builds`
| Metodo | Path | Auth | Descrizione |
|---|---|---|---|
| GET | `/` | utente | Build dell'utente autenticato |
| GET | `/shared/:id` | — | Build pubblica condivisibile via link |
| GET | `/:id` | utente | Dettaglio build |
| POST | `/` | utente | Crea build |
| PUT | `/:id` | utente | Aggiorna build |
| DELETE | `/:id` | utente | Elimina build |
| POST | `/validate` | — | Valida compatibilità di una configurazione |

### Statistiche — `/api/stats`
| Metodo | Path | Descrizione |
|---|---|---|
| GET | `/` | Conteggi componenti per tipo, marche, numero build totali |

## Popolare il database

Ogni categoria di componente ha un CSV e un relativo script di seed in `scripts/`:

```bash
node scripts/CPU/seed-cpu.js --csv ./scripts/CPU/CPU.csv
# --drop per ricreare la tabella prima di importare
```

Stesso pattern per `CASE`, `COOLER`, `GPU`, `MEMORY`, `MOTHERBOARD`, `PSU`, `STORAGE`.