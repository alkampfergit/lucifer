import { useEffect, useState } from 'react'
import { loadHealthStatus } from '../domains/web-shell/service/load_health_status'
import type { HealthStatus } from '../domains/web-shell/types/health_status'
import { HealthStatusCard } from '../domains/web-shell/ui/health_status_card'
import './App.css'

export function App() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const hydrateHealthStatus = async () => {
      try {
        const nextHealthStatus = await loadHealthStatus()

        if (isMounted) {
          setHealthStatus(nextHealthStatus)
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Unknown status error',
          )
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void hydrateHealthStatus()

    return () => {
      isMounted = false
    }
  }, [])

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Azure-ready starter</p>
        <h1>Lucifer</h1>
        <p className="hero-copy">
          A Node + React starter wired for local development, GitHub Actions,
          and Docker-based Azure Container Apps deployment.
        </p>
        <div className="hero-actions">
          <a href="/api/health" target="_blank" rel="noreferrer">
            API health
          </a>
          <a
            href="https://learn.microsoft.com/azure/container-apps/"
            target="_blank"
            rel="noreferrer"
          >
            Azure Container Apps docs
          </a>
        </div>
      </section>

      <section className="content-grid">
        <HealthStatusCard
          errorMessage={errorMessage}
          healthStatus={healthStatus}
          isLoading={isLoading}
        />
        <article className="info-card">
          <h2>What is included</h2>
          <ul>
            <li>Vite + React frontend</li>
            <li>Express API and static asset host</li>
            <li>Harness engineering repo scaffolding from ai-landscape</li>
            <li>CI checks plus Azure deployment workflow</li>
          </ul>
        </article>
      </section>
    </main>
  )
}
