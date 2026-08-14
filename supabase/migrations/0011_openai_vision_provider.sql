alter table public.highlight_scores
  drop constraint if exists highlight_scores_provider_check;

alter table public.highlight_scores
  add constraint highlight_scores_provider_check
  check (provider in ('gemini', 'heuristic', 'openai'));
