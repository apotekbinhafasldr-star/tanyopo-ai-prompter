-- Tanyopo AI Promoter — Phase 6 (TikTok + X connectors)
--
-- No new table — Phase 6 adds real connector implementations
-- (lib/connectors/tiktok-connector.ts, lib/connectors/x-connector.ts)
-- and updates the read-only capability registry seeded in Phase 3 to
-- reflect what's now actually implemented. Same additive-only rule as
-- every prior migration; no UMKMpro table is touched.
--
-- "enabled = true" means "this codebase has a real implementation
-- attempting the call," not "verified against a live account" or "no
-- remaining gaps" — Meta's own CREATE_AD row was already enabled=true
-- despite its documented Page-picker gap (see Phase 3). TikTok/X's
-- CREATE_CAMPAIGN/CREATE_AD rows follow the same convention: real code
-- exists, and the specific remaining gap (unverified location-catalog
-- mapping, no asset-upload/tweet-composition flow) is named in `notes`
-- rather than hidden by leaving the capability disabled.

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = null
where platform = 'TIKTOK' and capability = 'CONNECT_ACCOUNT';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Insight dasar (spend/impressions/reach/clicks) — belum diverifikasi ke akun nyata.'
where platform = 'TIKTOK' and capability = 'READ_ANALYTICS';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Campaign dapat dibuat, tapi ad set (targeting) berhenti di sini — TikTok memerlukan location_id numerik yang belum ada pemetaan terverifikasi dari kode negara ISO.'
where platform = 'TIKTOK' and capability = 'CREATE_CAMPAIGN';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Kode lengkap ada, tapi tidak tercapai lewat alur peluncuran nyata hari ini — berhenti lebih dulu di tahap ad set (lihat CREATE_CAMPAIGN) dan creative (belum ada alur unggah aset).'
where platform = 'TIKTOK' and capability = 'CREATE_AD';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Memerlukan advertiser_id — diteruskan oleh connector, belum diverifikasi ke akun nyata.'
where platform = 'TIKTOK' and capability = 'UPDATE_BUDGET';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = 'v1.3',
    notes = 'Belum diverifikasi ke akun nyata.'
where platform = 'TIKTOK' and capability = 'PAUSE_CAMPAIGN';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = null
where platform = 'X' and capability = 'CONNECT_ACCOUNT';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Insight dasar (spend/impressions/clicks) — belum diverifikasi ke akun nyata. Tidak ada metrik reach yang sebanding di API X, dilaporkan 0 daripada menebak.'
where platform = 'X' and capability = 'READ_ANALYTICS';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Campaign dapat dibuat (funding instrument otomatis dipilih), tapi ad set (line item/targeting) berhenti di sini — X memerlukan location_id numerik yang belum ada pemetaan terverifikasi dari kode negara ISO.'
where platform = 'X' and capability = 'CREATE_CAMPAIGN';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Kode lengkap ada, tapi tidak tercapai lewat alur peluncuran nyata hari ini — berhenti lebih dulu di tahap ad set (lihat CREATE_CAMPAIGN) dan creative (Promoted Tweet memerlukan tweet yang sudah ada, belum ada alur membuat tweet).'
where platform = 'X' and capability = 'CREATE_AD';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Belum diverifikasi ke akun nyata.'
where platform = 'X' and capability = 'UPDATE_BUDGET';

update public.prompter_platform_capabilities
set enabled = true,
    api_version = '12',
    notes = 'Belum diverifikasi ke akun nyata.'
where platform = 'X' and capability = 'PAUSE_CAMPAIGN';

-- PUBLISH_CONTENT (organic posting) stays disabled for both — same as
-- Meta: this phase only covers each platform's ads/marketing API.
