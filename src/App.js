import React, { useState } from 'react';
import ScanGate from './components/ScanGate';
import PickList from './components/PickList';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { LOGO_SRC } from './logo';
import './App.css';

export default function App() {
  const [order, setOrder] = useState(null); // loaded sales order, or null

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="app">
          <header className="app-header">
            <div className="header-inner">
              <img src={LOGO_SRC} alt="PMI Tape" className="header-logo" />
              <span className="header-divider" />
              <span className="header-page-title">Order Pulling</span>
            </div>
          </header>

          <main className="app-main">
            {!order ? (
              <ScanGate onLoaded={setOrder} />
            ) : (
              <PickList order={order} onDone={() => setOrder(null)} />
            )}
          </main>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
