FROM nginx:1.27-alpine3.21
# Pin Node.js to exact Alpine package version for reproducible builds.
# Update cadence: bump when Alpine 3.21 publishes security patches for nodejs.
RUN apk add --no-cache 'nodejs=22.15.1-r0'
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
