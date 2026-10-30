import { Check, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { answerMatches, isChoice, shuffledOptions, type AnswerQuestion, type ChoiceQuestion, type Question as Q } from '../lib/lessons';
import { MarkdownInline } from './Markdown';
import { Button } from './primitives';

/**
 * One question, multiple choice or typed recall. Wrong answers explain themselves and you can try again;
 * onFirstAnswer reports whether the first try was right (that's what a review scores).
 */
export function Question({ q, label, onFirstAnswer }: { q: Q; label: string; onFirstAnswer?: (right: boolean) => void }) {
  return isChoice(q)
    ? <Choice q={q} label={label} onFirstAnswer={onFirstAnswer} />
    : <Recall q={q} label={label} onFirstAnswer={onFirstAnswer} />;
}

function Choice({ q, label, onFirstAnswer }: { q: ChoiceQuestion; label: string; onFirstAnswer?: (right: boolean) => void }) {
  const options = useMemo(() => shuffledOptions(q.options, q.q), [q]);
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = picked === null ? null : options[picked];
  const pick = (i: number) => {
    if (picked === null) onFirstAnswer?.(options[i].correct);
    setPicked(i);
  };
  return (
    <fieldset className="quiz">
      <legend><span className="label">{label}</span> <MarkdownInline text={q.q} /></legend>
      <div className="quiz-options">
        {options.map((o, i) => (
          <button key={i} type="button" className={`quiz-option${picked === i ? (o.correct ? ' is-right' : ' is-wrong') : ''}`}
            aria-pressed={picked === i} onClick={() => pick(i)}>
            {picked === i && (o.correct ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />)}
            <MarkdownInline text={o.text} />
          </button>
        ))}
      </div>
      <p className={`small quiz-why${chosen ? (chosen.correct ? ' is-right' : ' is-wrong') : ''}`} role="status">
        {chosen && <><b>{chosen.correct ? 'Right.' : 'Not quite.'}</b> <MarkdownInline text={chosen.why} />{!chosen.correct && ' Try another.'}</>}
      </p>
    </fieldset>
  );
}

function Recall({ q, label, onFirstAnswer }: { q: AnswerQuestion; label: string; onFirstAnswer?: (right: boolean) => void }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [tries, setTries] = useState(0);
  const [state, setState] = useState<'open' | 'right' | 'wrong' | 'shown'>('open');
  const submit = () => {
    if (!value.trim() || state === 'right' || state === 'shown') return;
    const right = answerMatches(value, q.answer);
    if (tries === 0) onFirstAnswer?.(right);
    setTries((t) => t + 1);
    setState(right ? 'right' : 'wrong');
  };
  const reveal = () => {
    if (tries === 0) onFirstAnswer?.(false);
    setState('shown');
  };
  const done = state === 'right' || state === 'shown';
  return (
    <fieldset className="quiz">
      <legend><span className="label">{label}</span> <MarkdownInline text={q.q} /></legend>
      <form className="recall" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="sr-only" htmlFor={id}>Your answer</label>
        <input id={id} className={`recall-input${state === 'right' ? ' is-right' : state === 'wrong' ? ' is-wrong' : ''}`}
          value={value} onChange={(e) => { setValue(e.target.value); if (state === 'wrong') setState('open'); }}
          readOnly={done} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Your answer" />
        {!done && <Button type="submit" disabled={!value.trim()}>Check</Button>}
        {!done && tries > 0 && <Button variant="muted" onClick={reveal}>Show answer</Button>}
      </form>
      <p className={`small quiz-why${state === 'right' ? ' is-right' : state === 'wrong' || state === 'shown' ? ' is-wrong' : ''}`} role="status">
        {state === 'right' && <><b>Right.</b> <MarkdownInline text={q.why} /></>}
        {state === 'wrong' && <><b>Not quite.</b> Try again, or show the answer.</>}
        {state === 'shown' && <><b>Answer: <MarkdownInline text={`\`${q.answer[0]}\``} />.</b> <MarkdownInline text={q.why} /></>}
      </p>
    </fieldset>
  );
}
