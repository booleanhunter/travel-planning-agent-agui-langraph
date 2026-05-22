import ReactDOM from 'react-dom/client';
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import App from './App.tsx';
import './styles/theme.css';
import './styles/app.css';

// runtimeUrl points at the Express-mounted CopilotKit runtime
// (server/src/modules/itinerary/api/itinerary-routes.ts). Vite's dev proxy
// forwards /api/* to localhost:3000 — see client/vite.config.ts.
ReactDOM.createRoot(document.getElementById('root')!).render(
    <CopilotKitProvider runtimeUrl="/api/itinerary/copilotkit">
        <App />
    </CopilotKitProvider>,
);
