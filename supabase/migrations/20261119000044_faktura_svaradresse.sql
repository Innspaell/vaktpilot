-- Svar på betalingspåminnelser går til faktura@vaktpilot.no (andre e-poster fra InnSpæll går til support)
do $$ begin
  execute (select replace(pg_get_functiondef('run_billing_dunning(date)'::regprocedure),
    $a$'reply_to', support_reply_to()$a$, $b$'reply_to', 'faktura@vaktpilot.no'$b$));
end $$;
