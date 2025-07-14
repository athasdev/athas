# Interceptor

The Interceptor package is a transparent HTTP proxy server designed to intercept, parse, and monitor API requests and responses to the Anthropic Claude API. It acts as a middleware layer that captures both streaming and non-streaming API communications, providing real-time visibility into the request/response cycle while forwarding traffic seamlessly to the actual API endpoints.

Built with Rust and Axum, the interceptor supports WebSocket connections for live monitoring of intercepted traffic. It parses Claude API message formats, tracks conversation flows, and handles streaming responses efficiently. The package is particularly useful for debugging API interactions, monitoring token usage, and understanding the structure of Claude API communications in development environments.

## Flow Diagram

```mermaid
graph LR
    Client[API Client] -->|HTTP Request| Proxy[Interceptor Proxy<br/>:port]
    Proxy -->|Parse & Store| State[(State Store)]
    Proxy -->|Forward Request| Claude[Claude API<br/>api.anthropic.com]
    Claude -->|Response| Proxy
    Proxy -->|Parse Response| State
    State -->|Broadcast Events| WS[WebSocket<br/>Subscribers]
    Proxy -->|Return Response| Client

    subgraph Interceptor Components
        Proxy
        State
        Parser[Parser Module]
        Proxy -.->|Uses| Parser
    end

    style Proxy fill:#f9f,stroke:#333,stroke-width:2px
    style State fill:#bbf,stroke:#333,stroke-width:2px
    style WS fill:#bfb,stroke:#333,stroke-width:2px
```
