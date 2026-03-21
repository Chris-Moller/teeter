FROM nginx:1.27-alpine3.21
# Pin Node.js to major version 22 (Alpine 3.21 ships 22.x); base image
# is pinned to alpine3.21 so the exact patch version is repo-deterministic.
RUN apk add --no-cache 'nodejs~=22'
RUN rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/
COPY api/server.js /app/api/server.js
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
RUN nginx -t
VOLUME /data
EXPOSE 8080
CMD ["/app/start.sh"]
