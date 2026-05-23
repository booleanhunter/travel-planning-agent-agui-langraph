import { useState, type FormEvent } from "react";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PromptInput({ onSubmit, disabled, placeholder }: Props) {
  const [text, setText] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setText("");
  };

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <input
        className="prompt-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "Ask the trip planner…"}
        disabled={disabled}
        autoFocus
      />
      <button className="prompt-submit" type="submit" disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  );
}
