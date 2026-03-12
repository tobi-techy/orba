FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client
RUN bunx prisma generate

# Expose port
EXPOSE 3001

# Start server
CMD ["bun", "src/index.ts"]
