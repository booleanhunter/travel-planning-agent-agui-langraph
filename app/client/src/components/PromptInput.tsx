import { useState, type FormEvent } from 'react';

interface Props {
    onSubmit: (text: string) => void;
    disabled?: boolean;
    placeholder?: string;
}

export function PromptInput({ onSubmit, disabled, placeholder }: Props) {
    const [text, setText] = useState('');

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        const trimmed = text.trim();
        if (!trimmed || disabled) return;
        onSubmit(trimmed);
        setText('');
    };

    return (
        <form className="prompt-form" onSubmit={handleSubmit}>
            <input
                className="prompt-input"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={placeholder ?? 'Ask the trip planner…'}
                disabled={disabled}
                autoFocus
            />
            <button className="prompt-submit" type="submit" disabled={disabled || !text.trim()}>
                Send
            </button>
        </form>
    );
}
