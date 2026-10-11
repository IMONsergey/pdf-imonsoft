import type { Tool } from '../lib/types';
import { Icon } from './Icon';

export function ToolCard({ tool, featured = false, unavailable = false }: { tool: Tool; featured?: boolean; unavailable?: boolean }) {
  return <a className={`tool-card ${featured ? 'featured-card' : ''}`} href={`#/tools/${tool.id}`}>
    <div className="tool-card-top"><span className={`tool-icon ${featured ? 'large' : ''}`}><Icon name={tool.icon} size={featured ? 25 : 22} /></span>
      {featured ? <span className="format-tag">{tool.output}</span> : <Icon name="arrow-up-right" size={17} className="card-arrow" />}
    </div>
    <div className="tool-card-copy"><h3>{tool.title}</h3><p>{tool.description}</p></div>
    {featured && <div className="featured-bottom"><span>Открыть инструмент</span><Icon name="arrow-right" size={19} /></div>}
    {unavailable && <span className="unavailable-note"><span className="status-dot warning" /> Движок не подключён</span>}
  </a>;
}
