#!/usr/bin/perl
# WHY NOT - genera lo script SQL di ripristino da un backup (file JSON già decifrato).
# Lo script prodotto si incolla nell'editor SQL di Supabase (Dashboard > SQL Editor) e si esegue.
#
# Uso (in Git Bash):
#   perl tools/ripristino-backup.pl backup.json > ripristino.sql
#       ANTEPRIMA (predefinita, non tocca nulla): copia il backup nello schema "ripristino",
#       dove si confronta con i dati attuali e si recupera solo ciò che serve.
#   perl tools/ripristino-backup.pl backup.json --sovrascrivi prenotazioni,schede > ripristino.sql
#       SOVRASCRIVE le tabelle indicate in public con il contenuto del backup (tutto o niente).
#   perl tools/ripristino-backup.pl backup.json --sovrascrivi tutte > ripristino.sql
#       ripristino completo (es. su un progetto nuovo, dopo aver eseguito i file supabase/*.sql).
# Opzione: --schema nome  -> schema di destinazione diverso (usato per i collaudi).
use strict; use warnings; use JSON::PP;

my $file = shift or die "Uso: perl tools/ripristino-backup.pl backup.json [--sovrascrivi t1,t2|tutte] [--schema nome]\n";
my ($modo, $lista, $schema) = ('anteprima', '', undef);
while (@ARGV) {
  my $o = shift;
  if ($o eq '--sovrascrivi') { $modo = 'sovrascrivi'; $lista = shift // die "--sovrascrivi vuole l'elenco delle tabelle (o 'tutte')\n"; }
  elsif ($o eq '--schema') { $schema = shift // die "--schema vuole un nome\n"; }
  else { die "Opzione sconosciuta: $o\n"; }
}
$schema //= $modo eq 'anteprima' ? 'ripristino' : 'public';
die "Nome schema non valido\n" unless $schema =~ /^[a-z_][a-z0-9_]*$/;

open my $fh, '<:raw', $file or die "Non riesco ad aprire $file: $!\n";
my $d = decode_json(do { local $/; <$fh> });
die "Il file non sembra un backup WHY NOT\n" unless ($d->{progetto} // '') eq 'whynot' && ref $d->{tabelle} eq 'HASH';
my $tab = $d->{tabelle};
my @tutte = sort grep { !/^_/ } keys %$tab;
my @scelte = $modo eq 'anteprima' || $lista eq 'tutte' ? @tutte : split /,/, $lista;
for (@scelte) { die "Tabella '$_' non presente nel backup\n" unless exists $tab->{$_}; die "Nome non valido: $_\n" unless /^[a-z_][a-z0-9_]*$/; }

my $J = JSON::PP->new->canonical->utf8(0);
my $lit = sub { my $s = $J->encode($_[0]); die "Delimitatore presente nei dati\n" if $s =~ /\$wnbk\$/; "\$wnbk\$$s\$wnbk\$" };

binmode STDOUT, ':encoding(UTF-8)';
print "-- WHY NOT - ripristino dal backup del $d->{creato}\n-- modo: $modo, schema: $schema, tabelle: ", join(', ', @scelte), "\n";
print "begin;\n";
if ($modo eq 'anteprima') {
  print "create schema if not exists $schema;\nrevoke all on schema $schema from public, anon, authenticated;\n";
  for my $t (@scelte) {
    print "drop table if exists $schema.$t;\ncreate table $schema.$t (like public.$t);\n";
    print "insert into $schema.$t select * from jsonb_populate_recordset(null::public.$t, ", $lit->($tab->{$t}), "::jsonb);\n";
  }
  if ($tab->{_utenti}) {
    print "drop table if exists $schema._utenti;\ncreate table $schema._utenti (id uuid, email text, creato timestamptz);\n";
    print "insert into $schema._utenti select * from jsonb_populate_recordset(null::$schema._utenti, ", $lit->($tab->{_utenti}), "::jsonb);\n";
  }
} else {
  # niente trigger né controlli di chiave esterna durante il caricamento (nessuna notifica parte)
  print "set local session_replication_role = replica;\n";
  for my $t (@scelte) {
    print "delete from $schema.$t;\n";
    print "insert into $schema.$t overriding system value select * from jsonb_populate_recordset(null::public.$t, ", $lit->($tab->{$t}), "::jsonb);\n";
  }
  # i contatori degli id ripartono dal massimo ripristinato
  my $in = join(',', map { "'$_'" } @scelte);
  print <<"SQL";
do \$\$ declare r record; begin
  for r in select c.table_name, c.column_name from information_schema.columns c
            where c.table_schema = '$schema' and c.table_name in ($in) and c.is_identity = 'YES' loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), greatest(coalesce((select max(%I) from %I.%I), 0), 1))',
                   '$schema.' || r.table_name, r.column_name, r.column_name, '$schema', r.table_name);
  end loop;
end \$\$;
SQL
}
print "commit;\n";
print "-- righe ripristinate: ", join(', ', map { "$_=" . scalar(@{$tab->{$_}}) } @scelte), "\n";
