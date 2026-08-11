alter table bridge_ai."ProductCategory"
  add column if not exists "acknowledgementDeadlineHours" integer,
  add column if not exists "quotationDeadlineHours" integer;

alter table bridge_ai."ProductCategory"
  drop constraint if exists "ProductCategory_acknowledgementDeadlineHours_check",
  add constraint "ProductCategory_acknowledgementDeadlineHours_check"
    check ("acknowledgementDeadlineHours" is null or "acknowledgementDeadlineHours" between 1 and 168),
  drop constraint if exists "ProductCategory_quotationDeadlineHours_check",
  add constraint "ProductCategory_quotationDeadlineHours_check"
    check ("quotationDeadlineHours" is null or "quotationDeadlineHours" between 1 and 336);

comment on column bridge_ai."ProductCategory"."acknowledgementDeadlineHours" is
  'Optional industry-level supplier acknowledgement window in Bridge AI business hours.';
comment on column bridge_ai."ProductCategory"."quotationDeadlineHours" is
  'Optional industry-level quotation window in Bridge AI business hours.';
