# RoleMatch's own PostgreSQL (ADR-004, docs/database/07_BACKUP_RECOVERY.md): the official PostgreSQL 17 image plus pgBackRest from the PostgreSQL project's
# own package repository, which the official image already trusts. Nothing else is added.
FROM postgres:17.6-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends pgbackrest && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest /etc/pgbackrest && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /etc/pgbackrest
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY rolematch.conf /etc/postgresql/rolematch.conf
COPY 00-roles.sh /docker-entrypoint-initdb.d/00-roles.sh
COPY app-role.sql /docker-entrypoint-initdb.d/app-role.sql.in
COPY pgbackrest-keyed /usr/local/bin/pgbackrest-keyed
CMD ["postgres", "-c", "config_file=/etc/postgresql/rolematch.conf"]
