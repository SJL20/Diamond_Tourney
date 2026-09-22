FROM alpine:3.21
RUN apk add --no-cache ca-certificates unzip curl tzdata poppler-utils python3
WORKDIR /app
ARG PB_VERSION=0.40.4
RUN curl -sL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -o /tmp/pb.zip \
  && unzip /tmp/pb.zip -d /app \
  && rm /tmp/pb.zip \
  && chmod +x /app/pocketbase
COPY scripts/pdf_box_text.py /app/scripts/pdf_box_text.py
COPY pb/pb_migrations ./pb_migrations
COPY pb/pb_hooks ./pb_hooks
COPY pb/pb_public ./pb_public
EXPOSE 8080
ENV TZ=America/New_York
CMD ["./pocketbase", "serve", "--http=0.0.0.0:8080", "--dir=/data", "--migrationsDir=/app/pb_migrations", "--hooksDir=/app/pb_hooks", "--publicDir=/app/pb_public"]
