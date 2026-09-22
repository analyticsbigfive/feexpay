-- ---------------------------------------------------------------------------
-- Demande de contact depuis le rapport (P12)
--
-- Le bouton « Contacter FeexPay » ouvrait un `mailto:` : sur mobile et dans les webmails,
-- il n'ouvre souvent rien, et la demande partait sans laisser de trace. Elle passe désormais
-- par une fenêtre modale et une route serveur, qui envoie l'email au contact commercial et
-- dépose la demande sur la fiche prospect (A04).
--
-- prospect_note.source : une note écrite par le dirigeant depuis son rapport n'a pas
-- d'`author_id`. Sans cette colonne, la fiche l'affichait « Compte supprimé », ce qui est faux.
--
-- app_setting.contact_commercial_email : l'adresse qui reçoit les demandes, modifiable par un
-- Administrateur depuis l'écran des réglages, comme les identifiants de tracking.
-- ---------------------------------------------------------------------------

alter table prospect_note add column if not exists source text not null default 'admin';

do $$
begin
  alter table prospect_note add constraint prospect_note_source_check
    check (source in ('admin', 'dirigeant'));
exception
  when duplicate_object then null;
end $$;

insert into app_setting (key, value, secret) values
  ('contact_commercial_email', 'contact.ci@feexpay.me', false)
on conflict (key) do nothing;
