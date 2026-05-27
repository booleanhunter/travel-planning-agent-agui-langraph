import { useEffect, useState } from 'react';
import type { URLElicitSpec } from '../types';

interface Props {
    spec: URLElicitSpec;
    /** Called when the OAuth callback page posts an oauth-complete message
     *  with this elicitationId. The host (App.tsx) then auto-resubmits the
     *  pending turn so the agent can resume with the cached token. */
    onComplete: () => void;
    /** Optional dismiss — user closed the dialog without signing in. */
    onCancel?: () => void;
}

/**
 * URL-mode elicit card. Renders a "Continue with Google" CTA that opens the
 * elicit's `url` in a new tab (the OAuth flow). Listens for a postMessage
 * from the callback page; on a match (same origin + matching elicitationId)
 * calls `onComplete`.
 */
export function ElicitUrlCard({ spec, onComplete, onCancel }: Props) {
    const [opened, setOpened] = useState(false);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            // Same-origin only — OAuth callback page is served from our domain.
            if (event.origin !== window.location.origin) return;
            const data = event.data as
                | { type?: string; elicitationId?: string }
                | null
                | undefined;
            if (!data || data.type !== 'oauth-complete') return;
            if (data.elicitationId !== spec.elicitationId) return;
            onComplete();
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [spec.elicitationId, onComplete]);

    const handleOpen = () => {
        // Important: no `noopener`/`noreferrer` — both would null out
        // window.opener in the OAuth tab, breaking the postMessage path the
        // callback page uses to signal completion back here.
        window.open(spec.url, '_blank');
        setOpened(true);
    };

    return (
        <div className="elicit-card">
            <p className="elicit-message">{spec.message}</p>
            <div className="elicit-actions">
                {onCancel && (
                    <button type="button" className="elicit-decline" onClick={onCancel}>
                        Cancel
                    </button>
                )}
                <button type="button" className="elicit-submit" onClick={handleOpen}>
                    {opened ? 'Waiting for sign-in…' : 'Continue with Google'}
                </button>
            </div>
            {opened && (
                <div className="elicit-help" style={{ marginTop: 8 }}>
                    Complete the sign-in in the new tab. Your trip will save automatically.
                </div>
            )}
        </div>
    );
}
