use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "knx_core=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();

    info!("Starting KoNfiX Engine — Visual KNX Configurator");

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    knx_core::server::start_server(port).await?;

    Ok(())
}
