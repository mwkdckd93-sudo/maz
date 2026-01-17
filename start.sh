#!/bin/sh

echo "Running database migrations..."
npm run migrate

echo "Starting server..."
npm start
