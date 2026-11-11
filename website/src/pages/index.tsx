import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

const QUICK_START = `import { Module } from '@nestjs/common';
import { TelemetryModule } from '@nestjs-telemetry/core';

@Module({
  imports: [TelemetryModule.forRoot()],
})
export class AppModule {}

// npm run start, then open http://localhost:3000/telemetry`;

type Watcher = {name: string; what: string; doc: string};

const WATCHERS: Watcher[] = [
  {name: 'Requests', what: 'Method, URL, status, duration, headers, request and response bodies, user and tenant.', doc: '/docs/watchers/requests'},
  {name: 'Exceptions', what: 'Error class, message, stack trace and the request that raised it.', doc: '/docs/watchers/exceptions'},
  {name: 'Queries', what: 'SQL and Prisma operations with their duration, from the TypeORM and Prisma packages.', doc: '/docs/integrations/typeorm'},
  {name: 'Logs', what: 'Every level written through the Nest logger, filtered by context if you want.', doc: '/docs/watchers/logs'},
  {name: 'Schedules', what: 'Scheduled task runs: duration, status and the error of a failed run.', doc: '/docs/watchers/schedules'},
  {name: 'Cache', what: 'Cache hits and misses of the routes that use the cache.', doc: '/docs/watchers/cache'},
  {name: 'Events', what: 'Event name, payload and the handler that ran.', doc: '/docs/watchers/events'},
  {name: 'Mail', what: 'Every nodemailer / MailerService send, rendered, with its status, picked up with no code.', doc: '/docs/watchers/mail'},
  {name: 'Models', what: 'Entities created, updated and deleted, with the changed fields.', doc: '/docs/integrations/typeorm'},
];

type Feature = {title: string; body: ReactNode};

const FEATURES: Feature[] = [
  {
    title: 'One import, a full dashboard',
    body: (
      <>
        <code>TelemetryModule.forRoot()</code> mounts a single-page dashboard and its JSON API next to
        your routes. No build step, no agent, no external service.
      </>
    ),
  },
  {
    title: 'Everything a request did, together',
    body: (
      <>
        Each HTTP request gets a batch ID through <code>AsyncLocalStorage</code>, so the queries, logs,
        exceptions and mail it caused are one click away from it.
      </>
    ),
  },
  {
    title: 'Masked by default',
    body: (
      <>
        Credentials are masked by field name at any depth, JWTs by their shape, and query strings
        of URLs, in requests, responses and mail alike.
      </>
    ),
  },
  {
    title: 'Memory or SQLite',
    body: (
      <>
        Keep the last entries per type in memory, or persist them to SQLite (WAL, buffered writes),
        with automatic pruning either way.
      </>
    ),
  },
];

function Hero(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroText}>
          <Heading as="h1" className={styles.title}>
            {siteConfig.title}
          </Heading>
          <p className={styles.tagline}>{siteConfig.tagline}</p>
          <p className={styles.lede}>
            Inspect requests, exceptions, SQL queries, logs, scheduled tasks, cache operations,
            events, mail and model changes of a NestJS app, as they happen.
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/docs/getting-started/installation">
              Get started
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/intro">
              What it records
            </Link>
          </div>
          <CodeBlock language="bash" className={styles.install}>
            npm install @nestjs-telemetry/core
          </CodeBlock>
        </div>
        <div className={styles.heroCode}>
          <CodeBlock language="typescript" title="app.module.ts">
            {QUICK_START}
          </CodeBlock>
        </div>
      </div>
    </header>
  );
}

function Features(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.featureGrid}>
          {FEATURES.map((feature) => (
            <div key={feature.title} className={styles.card}>
              <Heading as="h3">{feature.title}</Heading>
              <p>{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Watchers(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Nine kinds of entries
        </Heading>
        <div className={styles.watcherGrid}>
          {WATCHERS.map((watcher) => (
            <Link key={watcher.name} to={watcher.doc} className={styles.watcher}>
              <strong>{watcher.name}</strong>
              <span>{watcher.what}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <Hero />
      <main>
        <Features />
        <Watchers />
      </main>
    </Layout>
  );
}
