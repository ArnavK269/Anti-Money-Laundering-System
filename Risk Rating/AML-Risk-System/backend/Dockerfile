# FIX: use .NET 10 SDK to match backend.csproj TargetFramework net10.0
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /app
COPY *.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/out .
EXPOSE 8081
ENTRYPOINT ["dotnet", "backend.dll"]
