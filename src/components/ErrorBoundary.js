import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  componentDidCatch(error) { this.setState({ error }); console.error('App error:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#f7f7f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
        <div style={{ background: '#fff', border: '.5px solid rgba(0,0,0,.12)', borderRadius: 12, padding: '2rem', maxWidth: 540, width: '100%', boxShadow: '0 4px 16px rgba(0,0,0,.08)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9a9a9a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Application Error</div>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#1a1a1a' }}>Something went wrong</h2>
          <p style={{ color: '#6b6b6b', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>Usually caused by missing Netlify environment variables. Check the dashboard and redeploy.</p>
          <pre style={{ background: '#fcebeb', border: '.5px solid rgba(163,45,45,.2)', borderRadius: 8, padding: '12px 14px', color: '#a32d2d', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 16 }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <div style={{ background: '#f7f7f5', border: '.5px solid rgba(0,0,0,.12)', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#6b6b6b', lineHeight: 1.8, marginBottom: 16 }}>
            <strong style={{ color: '#1a1a1a' }}>Required env vars:</strong><br/>
            ZOHO_CLIENT_ID · ZOHO_CLIENT_SECRET · ZOHO_ORGANIZATION_ID<br/>
            (plus ZOHO_REFRESH_TOKEN <em>or</em> client-credentials scope)
          </div>
          <button onClick={() => window.location.reload()} style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: 500 }}>Reload</button>
        </div>
      </div>
    );
  }
}
