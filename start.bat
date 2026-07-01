@echo off
title MatchLink Server
cd /d "%~dp0"
echo Starting MatchLink...
py server.py
if errorlevel 1 pause
