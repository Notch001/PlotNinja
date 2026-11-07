import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { runAutosaveNow } from '../lib/project'

interface State { error: Error | null; saved: 'saving' | 'ok' | 'failed' }

/**
 * Letzte Sicherung gegen Abstürze der Oberfläche: Statt eines weißen Fensters erscheint eine Meldung, die Arbeit wird
 * automatisch gesichert (Autosave) und lässt sich nach „Neu laden“ über die Wiederherstellung zurückholen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, saved: 'saving' }
  private saving: Promise<void> | null = null

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, saved: 'saving' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Oberflächenfehler:', error, info.componentStack)
    void this.save()
  }

  private save(): Promise<void> {
    if (!this.saving) {
      this.saving = runAutosaveNow().then(
        () => this.setState({ saved: 'ok' }),
        () => this.setState({ saved: 'failed' })
      )
    }
    return this.saving
  }

  private reload = async (): Promise<void> => {
    await this.save()
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const { saved } = this.state
    return (
      <div className="crash" role="alert" data-testid="crash">
        <div className="crash-card">
          <span className="crash-icon"><AlertTriangle size={30} /></span>
          <h1>Etwas ist schiefgegangen – Arbeit wird gesichert</h1>
          <p>
            {saved === 'saving' && 'Die automatische Sicherung läuft …'}
            {saved === 'ok' && 'Deine Arbeit wurde gesichert. Nach dem Neuladen bietet PlotNinja an, sie wiederherzustellen.'}
            {saved === 'failed' && 'Die automatische Sicherung war nicht möglich. Bitte lade neu; eine frühere Sicherung (falls vorhanden) wird dann angeboten.'}
          </p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <button className="btn primary big" onClick={() => void this.reload()}><RotateCw size={16} /> Neu laden</button>
        </div>
      </div>
    )
  }
}
