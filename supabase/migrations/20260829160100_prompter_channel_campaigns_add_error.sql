-- Records why a channel campaign launch failed (Budget Guard already
-- blocks bad budgets before this point — this covers connector/API-level
-- failures, e.g. no Facebook Page connected yet for creative creation).
alter table public.prompter_channel_campaigns add column error text;
