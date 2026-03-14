FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY prisma ./prisma
COPY src ./src
COPY start.sh ./start.sh
RUN chmod +x start.sh

# Generate Prisma client (use dummy URL for build, real URL at runtime)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bunx prisma generate

# Expose port
EXPOSE 3001

# Push schema and start server
CMD ["./start.sh"]
