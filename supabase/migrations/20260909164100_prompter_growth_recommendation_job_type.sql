alter table public.prompter_ai_jobs drop constraint if exists prompter_ai_jobs_job_type_check;

alter table public.prompter_ai_jobs add constraint prompter_ai_jobs_job_type_check
  check (job_type in (
    'MARKETING_BLUEPRINT', 'CAMPAIGN_PROPOSAL', 'CONTENT_GENERATION',
    'SEO_RECOMMENDATIONS', 'ANALYTICS_INSIGHT', 'OPTIMIZATION_RECOMMENDATION',
    'GROWTH_RECOMMENDATION'
  ));
